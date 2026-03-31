import mongoose, { Schema, Document, Types } from 'mongoose';

// @ts-ignore
export interface IGuardrailEvent extends Document {
  user: Types.ObjectId;
  guardrailType: string;
  action: string;
  severity: string;
  details: {
    entityTypes?: string[];
    entityCount?: number;
    message?: string;
    [key: string]: unknown;
  };
  route: string;
  conversationId?: string;
  messageId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  tenantId?: string;
}

const guardrailEventSchema: Schema<IGuardrailEvent> = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    guardrailType: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['block', 'warn', 'allow'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: 'medium',
    },
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },
    route: {
      type: String,
    },
    conversationId: {
      type: String,
    },
    messageId: {
      type: String,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for admin reporting queries
guardrailEventSchema.index({ createdAt: 1, tenantId: 1 }, { background: true });
guardrailEventSchema.index({ user: 1, createdAt: 1 }, { background: true });
guardrailEventSchema.index({ guardrailType: 1, createdAt: 1 }, { background: true });
guardrailEventSchema.index({ guardrailType: 1, action: 1, createdAt: 1 }, { background: true });

export default guardrailEventSchema;
