import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Spinner, useToastContext, Label, Button } from '@librechat/client';
import { useExportUserDataMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { logger } from '~/utils';

const BYTES_PER_MB = 1024 * 1024;

function responseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const { response } = error;
  if (typeof response !== 'object' || response === null || !('status' in response)) {
    return undefined;
  }
  return typeof response.status === 'number' ? response.status : undefined;
}

function ExportData() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [receivedMb, setReceivedMb] = useState<number | null>(null);
  const { mutate, isLoading } = useExportUserDataMutation();

  const handleExport = useCallback(() => {
    setReceivedMb(null);
    mutate((event) => setReceivedMb(event.loaded / BYTES_PER_MB), {
      onSuccess: () => {
        showToast({
          message: localize('com_ui_export_data_success'),
          status: NotificationSeverity.SUCCESS,
        });
      },
      onError: (error) => {
        logger.error('Data export error:', error);
        showToast({
          message: localize(
            responseStatus(error) === 429
              ? 'com_ui_export_data_in_progress'
              : 'com_ui_export_data_error',
          ),
          status: NotificationSeverity.ERROR,
        });
      },
      onSettled: () => setReceivedMb(null),
    });
  }, [mutate, localize, showToast]);

  const progressLabel =
    receivedMb === null
      ? localize('com_ui_export_data_preparing')
      : localize('com_ui_export_data_progress', { 0: receivedMb.toFixed(1) });

  return (
    <div className="flex items-center justify-between gap-2">
      <Label id="export-data-label">{localize('com_ui_export_data_info')}</Label>
      <Button
        variant="outline"
        onClick={handleExport}
        disabled={isLoading}
        aria-labelledby="export-data-label"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <>
            <Spinner className="mr-1 w-4" />
            <span>{progressLabel}</span>
          </>
        ) : (
          <>
            <Download className="mr-1 flex h-4 w-4 items-center stroke-1" aria-hidden="true" />
            <span>{localize('com_ui_export_data')}</span>
          </>
        )}
      </Button>
    </div>
  );
}

export default ExportData;
