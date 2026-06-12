import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceNowClient } from '../../clients/servicenow.js';
import { SnApiError } from '../../clients/servicenow.js';
import { buildTestPair, firstText } from '../../tests/helpers.js';
import {
  registerCatalogTranslationTools,
  TRANSLATION_CONFIG,
} from './translations.js';

const ITEM_SYS_ID = '7bad3ce593700310eb4cf83bdd03d69d';
const EXISTING_TRANS_SYS_ID = 'eeee5555ffff6666eeee5555ffff6666';

function buildMockClient(): ServiceNowClient {
  return {
    listRecords: vi
      .fn()
      .mockResolvedValue([
        { id: { value: 'es', display_value: 'es' } },
        { id: { value: 'en', display_value: 'en' } },
      ]),
    getRecord: vi.fn().mockResolvedValue({
      question_text: { value: 'Device Type', display_value: 'Device Type' },
      tooltip: { value: '', display_value: '' },
      help_tag: { value: '', display_value: '' },
      example_text: { value: '', display_value: '' },
    }),
    createRecord: vi.fn().mockResolvedValue({
      sys_id: { value: 'new000', display_value: 'new000' },
    }),
    updateRecord: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceNowClient;
}

describe('catalog-translations tools (in-memory MCP)', () => {
  describe('translate_catalog_item — disabled (default)', () => {
    let mcpClient: Client;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const pair = await buildTestPair(
        registerCatalogTranslationTools,
        buildMockClient(),
      );
      mcpClient = pair.mcpClient;
      teardown = pair.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    it('returns disabled message when TRANSLATION_CONFIG.enabled is false', async () => {
      const result = await mcpClient.callTool({
        name: 'translate_catalog_item',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          translations: { es: { item: { name: 'Solicitud de TI' } } },
        },
      });
      const text = firstText(result);
      expect(text).toContain('disabled');
      expect(result.isError).toBeFalsy();
    });
  });

  describe('translate_catalog_item — enabled', () => {
    let mcpClient: Client;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      (TRANSLATION_CONFIG as unknown as { enabled: boolean }).enabled = true;
      const pair = await buildTestPair(
        registerCatalogTranslationTools,
        buildMockClient(),
      );
      mcpClient = pair.mcpClient;
      teardown = pair.teardown;
    });

    afterEach(async () => {
      (TRANSLATION_CONFIG as unknown as { enabled: boolean }).enabled = false;
      await teardown();
    });

    it('writes item translations and returns success summary', async () => {
      const result = await mcpClient.callTool({
        name: 'translate_catalog_item',
        arguments: {
          catalog_item_sys_id: ITEM_SYS_ID,
          translations: {
            es: {
              item: {
                name: 'Solicitud de TI',
                short_description: 'Solicitar equipamiento de TI',
              },
            },
          },
        },
      });
      const text = firstText(result);
      expect(text).toContain('translations written');
      expect(text).toContain(ITEM_SYS_ID);
      expect(text).toContain('es');
      expect(result.isError).toBeFalsy();
    });

    it('returns isError when catalog_item_sys_id is not a valid hex id', async () => {
      const result = await mcpClient.callTool({
        name: 'translate_catalog_item',
        arguments: {
          catalog_item_sys_id: 'not-valid',
          translations: { es: { item: { name: 'X' } } },
        },
      });
      expect(result.isError).toBe(true);
      const text = firstText(result);
      expect(text).toContain('not a valid');
    });

    it('surfaces 403 SnApiError as partial-failure isError with status in message', async () => {
      const errorClient = {
        ...buildMockClient(),
        createRecord: vi
          .fn()
          .mockRejectedValue(
            new SnApiError(
              403,
              'Forbidden',
              'lang not installed',
              'https://example.com',
            ),
          ),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerCatalogTranslationTools,
        errorClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'translate_catalog_item',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            translations: { es: { item: { name: 'Solicitud de TI' } } },
          },
        });
        expect(result.isError).toBe(true);
        const text = firstText(result);
        expect(text).toContain('403');
        expect(text).toContain('partially failed');
      } finally {
        await pair.teardown();
      }
    });

    it('falls back to list+update when createRecord fails with non-auth error', async () => {
      const dupClient = {
        ...buildMockClient(),
        createRecord: vi.fn().mockRejectedValue(new Error('duplicate key')),
        listRecords: vi.fn().mockImplementation((table: string) => {
          if (table === 'sys_language') {
            return Promise.resolve([
              { id: { value: 'es', display_value: 'es' } },
            ]);
          }
          // return existing translation record for upsert fallback
          return Promise.resolve([
            {
              sys_id: {
                value: EXISTING_TRANS_SYS_ID,
                display_value: EXISTING_TRANS_SYS_ID,
              },
            },
          ]);
        }),
        updateRecord: vi.fn().mockResolvedValue({}),
      } as unknown as ServiceNowClient;
      const pair = await buildTestPair(
        registerCatalogTranslationTools,
        dupClient,
      );
      try {
        const result = await pair.mcpClient.callTool({
          name: 'translate_catalog_item',
          arguments: {
            catalog_item_sys_id: ITEM_SYS_ID,
            translations: { es: { item: { name: 'Solicitud de TI' } } },
          },
        });
        expect(dupClient.updateRecord).toHaveBeenCalledWith(
          'sys_translated_text',
          EXISTING_TRANS_SYS_ID,
          expect.any(Object),
        );
        expect(result.isError).toBeFalsy();
      } finally {
        await pair.teardown();
      }
    });
  });
});
