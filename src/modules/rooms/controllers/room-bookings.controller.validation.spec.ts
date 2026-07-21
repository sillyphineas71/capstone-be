import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RoomBookingQueryDto } from '../dto/room-booking-query.dto.js';
import { roomBookingQueryExceptionFactory } from './room-bookings.controller.js';

describe('roomBookingQueryExceptionFactory', () => {
  it('returns 422 UnprocessableEntityException when status is an invalid enum', async () => {
    const dto = plainToInstance(RoomBookingQueryDto, { status: 'invalid' });
    const errors = await validate(dto);

    const exception = roomBookingQueryExceptionFactory(errors);

    expect(exception).toBeInstanceOf(UnprocessableEntityException);
    expect(exception.getStatus()).toBe(422);
  });

  it('returns 422 UnprocessableEntityException when bookingType is an invalid enum', async () => {
    const dto = plainToInstance(RoomBookingQueryDto, {
      bookingType: 'invalid',
    });
    const errors = await validate(dto);

    const exception = roomBookingQueryExceptionFactory(errors);

    expect(exception).toBeInstanceOf(UnprocessableEntityException);
    expect(exception.getStatus()).toBe(422);
  });

  it('returns 400 BadRequestException when page < 1', async () => {
    const dto = plainToInstance(RoomBookingQueryDto, { page: 0 });
    const errors = await validate(dto);

    const exception = roomBookingQueryExceptionFactory(errors);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
  });

  it('returns 400 BadRequestException when from > to', async () => {
    const dto = plainToInstance(RoomBookingQueryDto, {
      from: '2026-07-02T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'to')).toBe(true);

    const exception = roomBookingQueryExceptionFactory(errors);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
  });

  it('passes validation when from <= to', async () => {
    const dto = plainToInstance(RoomBookingQueryDto, {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
