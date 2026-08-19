import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MeetingMinutesEntity } from './entities/meeting-minutes.entity.js';
import { MeetingMinutesShareEntity } from './entities/meeting-minutes-share.entity.js';
import { MediaFileEntity } from '../recording/entities/media-file.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { MinutesController } from './controllers/minutes.controller.js';
import { MeetingMinutesListController } from './controllers/minutes-list.controller.js';
import { MinutesAiDraftController } from './controllers/minutes-ai-draft.controller.js';
import { MinutesService } from './services/minutes.service.js';
import { MinutesAiDraftService } from './services/minutes-ai-draft.service.js';
import { MinutesExportService } from './services/minutes-export.service.js';
import { MinutesAiDraftProcessor } from './processors/minutes-ai-draft.processor.js';
import { MinutesExportWorkerProcessor } from './processors/minutes-export-worker.processor.js';
import { MockLlmProvider } from './ai/mock-llm.provider.js';
import { OllamaLlmProvider } from './ai/ollama-llm.provider.js';
import { LlmProviderFactory } from './ai/llm-provider.factory.js';
import {
  CONTEXT_RETRIEVER,
  EmptyContextRetriever,
} from './ai/context-retriever.port.js';

@Module({
  imports: [
    ConfigModule,
    AccountsModule,
    MeetingsModule,
    RecordingModule,
    TranscriptionModule,
    AuthModule,
    StorageModule,
    WebsocketModule,
    TypeOrmModule.forFeature([
      MeetingMinutesEntity,
      MeetingMinutesShareEntity,
      MediaFileEntity,
    ]),
  ],
  controllers: [
    MinutesController,
    MeetingMinutesListController,
    MinutesAiDraftController,
  ],
  providers: [
    MinutesService,
    MinutesAiDraftService,
    // UC-147: export minutes stack (service orchestrator + BullMQ worker)
    MinutesExportService,
    MinutesExportWorkerProcessor,
    // MKM-AI-01 worker stack (plan 7.2-7.3): processor + provider ports
    MinutesAiDraftProcessor,
    MockLlmProvider,
    OllamaLlmProvider,
    LlmProviderFactory,
    { provide: CONTEXT_RETRIEVER, useClass: EmptyContextRetriever },
  ],
  exports: [TypeOrmModule],
})
export class MinutesModule {}
