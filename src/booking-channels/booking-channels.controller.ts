import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BookingChannelsService } from './booking-channels.service';
import { ParseAndBookDto } from './dto/parse-and-book.dto';
import { InternalApiKeyGuard } from './guards/internal-api-key.guard';

/**
 * Booking Channels Controller
 *
 * The integration point for non-app booking sources: a WhatsApp agent, a voice
 * IVR, or any partner that can produce a sentence and a phone number.
 *
 * Note the response is always 200, even when the message could not be fully
 * understood. An ambiguous request returns status: 'clarification_needed' with
 * a question to relay back to the caller, because "which vehicle?" is a normal
 * turn in a conversation, not a client error.
 */
@ApiTags('Booking Channels')
@Controller('api/v1/booking-channels')
export class BookingChannelsController {
  constructor(
    private readonly bookingChannelsService: BookingChannelsService,
  ) {}

  /**
   * POST /api/v1/booking-channels/parse-and-book
   */
  @Post('parse-and-book')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Service-to-service key for channel integrations',
    required: true,
  })
  @ApiOperation({
    summary: 'Book a ride from a natural language message (WhatsApp / voice)',
  })
  @ApiBody({ type: ParseAndBookDto })
  @ApiOkResponse({
    description:
      "Either { status: 'booked', ride } or { status: 'clarification_needed', message }.",
  })
  async parseAndBook(@Body() dto: ParseAndBookDto) {
    return await this.bookingChannelsService.parseAndBook(dto);
  }
}
