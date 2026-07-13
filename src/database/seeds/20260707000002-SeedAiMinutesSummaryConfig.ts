import { DataSource } from 'typeorm';

/**
 * Seed system_configs cho AI Meeting Minutes Draft (MKM-AI-01) — spec 5.2.2.
 *
 * Key "ai.minutes_summary" dung config_json (jsonb) chua toan bo cau hinh:
 * - enabled=false mac dinh (fail-safe FR-014: thieu key hoac tat = tu choi job)
 * - provider=mock de dev/test khong can GPU/Ollama; doi sang self_hosted_llm
 *   khi demo LLM that
 * - ON CONFLICT DO NOTHING: chay lai khong de config da chinh tay (plan muc 12)
 *
 * Pattern: 20260616000002-SeedCheckinAlertConfig.ts
 */
export async function seedAiMinutesSummaryConfig(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const configJson = {
      enabled: false,
      provider: 'mock',
      modelName: 'qwen2.5:7b-instruct',
      allowExternalProvider: false,
      requireHumanReview: true,
      maxInputTokens: 6000,
      temperature: 0.2,
      retentionDays: 90,
      logRawTranscript: false,
    };

    await queryRunner.query(
      `INSERT INTO system_configs (config_key, config_json, value_type, config_group, description, is_active, version_no)
       VALUES ($1, $2, 'json', $3, $4, true, 1)
       ON CONFLICT (config_key) DO NOTHING;`,
      [
        'ai.minutes_summary',
        JSON.stringify(configJson),
        'ai',
        'Feature flag + cau hinh AI summarize meeting minutes (MKM-AI-01). enabled=false mac dinh; provider: mock | self_hosted_llm; model doi qua modelName khong can sua code.',
      ],
    );

    await queryRunner.commitTransaction();
    console.log('[Seed] AI minutes summary config seeded');
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
