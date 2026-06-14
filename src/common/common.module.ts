import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { QueryFailedFilter } from './filters/query-failed.filter.js';

@Module({
  providers: [
    {
      provide: APP_FILTER,
      useClass: QueryFailedFilter,
    },
  ],
})
export class CommonModule {}
