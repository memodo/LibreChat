import guardrailEventSchema, { IGuardrailEvent } from '~/schema/guardrailEvent';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createGuardrailEventModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(guardrailEventSchema);
  return (
    mongoose.models.GuardrailEvent ||
    mongoose.model<IGuardrailEvent>('GuardrailEvent', guardrailEventSchema)
  );
}
