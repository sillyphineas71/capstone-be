import 'reflect-metadata';

/**
 * Việc #4 (2026-07-29): kiểm chứng cờ TRANSCRIPTION_WORKER_ENABLED thực sự
 * loại/giữ TranscriptionWorkerProcessor khỏi `providers` — đây là cơ chế vá
 * bug "EC2 và máy cá nhân cùng giành job trên queue 'transcription'".
 *
 * Dùng require() + jest.resetModules() thay vì Test.createTestingModule():
 * chỉ cần đọc metadata @Module (reflect-metadata), không cần khởi tạo DI
 * container / kết nối DB thật của các module con (Accounts, Meetings, ...).
 */
interface TranscriptionModuleExports {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  TranscriptionModule: Function;
}
interface TranscriptionProcessorExports {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  TranscriptionWorkerProcessor: Function;
}

describe('TranscriptionModule — cờ TRANSCRIPTION_WORKER_ENABLED (việc #4)', () => {
  const ORIGINAL_ENV = process.env['TRANSCRIPTION_WORKER_ENABLED'];

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env['TRANSCRIPTION_WORKER_ENABLED'];
    } else {
      process.env['TRANSCRIPTION_WORKER_ENABLED'] = ORIGINAL_ENV;
    }
  });

  function loadFresh(): TranscriptionModuleExports &
    TranscriptionProcessorExports {
    jest.resetModules();

    /* eslint-disable @typescript-eslint/no-require-imports */
    const moduleExports =
      require('./transcription.module.js') as TranscriptionModuleExports;

    const processorExports =
      require('./transcription-worker.processor.js') as TranscriptionProcessorExports;
    /* eslint-enable @typescript-eslint/no-require-imports */
    return {
      TranscriptionModule: moduleExports.TranscriptionModule,
      TranscriptionWorkerProcessor:
        processorExports.TranscriptionWorkerProcessor,
    };
  }

  function getProviders(target: unknown): unknown[] {
    return Reflect.getMetadata('providers', target) as unknown[];
  }

  it('mặc định (biến không set) → TranscriptionWorkerProcessor CÓ trong providers', () => {
    delete process.env['TRANSCRIPTION_WORKER_ENABLED'];
    const { TranscriptionModule, TranscriptionWorkerProcessor } = loadFresh();

    expect(getProviders(TranscriptionModule)).toContain(
      TranscriptionWorkerProcessor,
    );
  });

  it("TRANSCRIPTION_WORKER_ENABLED='true' → CÓ trong providers", () => {
    process.env['TRANSCRIPTION_WORKER_ENABLED'] = 'true';
    const { TranscriptionModule, TranscriptionWorkerProcessor } = loadFresh();

    expect(getProviders(TranscriptionModule)).toContain(
      TranscriptionWorkerProcessor,
    );
  });

  it("TRANSCRIPTION_WORKER_ENABLED='false' → KHÔNG có trong providers (EC2 dùng giá trị này để nhường job cho máy cá nhân)", () => {
    process.env['TRANSCRIPTION_WORKER_ENABLED'] = 'false';
    const { TranscriptionModule, TranscriptionWorkerProcessor } = loadFresh();

    expect(getProviders(TranscriptionModule)).not.toContain(
      TranscriptionWorkerProcessor,
    );
  });
});
