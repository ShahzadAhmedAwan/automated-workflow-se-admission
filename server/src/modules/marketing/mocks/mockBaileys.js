/**
 * mockBaileys.js - Standalone mock simulation harness for Baileys WhatsApp client.
 * Allows testing outbound message queueing, inbound replies, and turn state transitions
 * without requiring an active WhatsApp Web connection or QR scanning.
 */

export class MockBaileysClient {
  constructor() {
    this.outbox = [];
    this.status = 'connected';
  }

  /**
   * Simulates receiving an inbound WhatsApp message from a user
   */
  async simulateInboundMessage(fromPhone, messageText, leadBotService, dbPool) {
    return await leadBotService.processIncomingMessage({
      fromPhone,
      messageBody: messageText,
      rawTimestamp: new Date(),
    }, dbPool);
  }

  /**
   * Records an outbound message being "sent" through Baileys
   */
  recordOutbound(recipientPhone, messageText, metadata = {}) {
    this.outbox.push({
      recipientPhone,
      messageText,
      metadata,
      sentAt: new Date().toISOString(),
    });
  }

  clearOutbox() {
    this.outbox = [];
  }
}
