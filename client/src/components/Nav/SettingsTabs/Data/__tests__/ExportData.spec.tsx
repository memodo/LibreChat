import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor, act } from 'test/layout-test-utils';
import ExportData from '../ExportData';

type ProgressHandler = (event: { loaded: number }) => void;

const mockGetUserDataExport = jest.fn();
const mockDownload = jest.fn();
const mockShowToast = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getUserDataExport: (onProgress: ProgressHandler) => mockGetUserDataExport(onProgress),
    },
  };
});

jest.mock('downloadjs', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockDownload(...args),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const zipResponse = {
  data: new Blob(['zip-bytes'], { type: 'application/zip' }),
  headers: { 'content-disposition': 'attachment; filename="memodoai-export-anna-2026-10-21.zip"' },
};

/** A download that stays open until the test settles it. */
function pendingDownload() {
  let resolve: (value: typeof zipResponse) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  mockGetUserDataExport.mockImplementation(
    () =>
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    resolve: (value: typeof zipResponse) => resolve(value),
    reject: (reason: unknown) => reject(reason),
    progress: (loaded: number) =>
      (mockGetUserDataExport.mock.calls[0][0] as ProgressHandler)({ loaded }),
  };
}

describe('ExportData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the download button when idle', () => {
    const { getByRole, getByText } = render(<ExportData />);
    expect(
      getByText(
        'Download all your conversations, files, memories, agents and skills as a zip archive',
      ),
    ).toBeInTheDocument();
    expect(getByRole('button')).toBeEnabled();
    expect(getByRole('button')).toHaveTextContent('Download');
  });

  it('disables the button and reports progress while downloading', async () => {
    const download = pendingDownload();
    const { getByRole } = render(<ExportData />);

    fireEvent.click(getByRole('button'));
    await waitFor(() => expect(getByRole('button')).toBeDisabled());
    expect(getByRole('button')).toHaveTextContent('Preparing your export…');

    act(() => download.progress(2.5 * 1024 * 1024));
    await waitFor(() => expect(getByRole('button')).toHaveTextContent('2.5 MB received'));

    download.resolve(zipResponse);
    await waitFor(() => expect(getByRole('button')).toBeEnabled());
  });

  it('saves the archive under the filename from the response header', async () => {
    mockGetUserDataExport.mockResolvedValue(zipResponse);
    const { getByRole } = render(<ExportData />);

    fireEvent.click(getByRole('button'));

    await waitFor(() =>
      expect(mockDownload).toHaveBeenCalledWith(
        zipResponse.data,
        'memodoai-export-anna-2026-10-21.zip',
        'application/zip',
      ),
    );
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Your data has been downloaded.' }),
      ),
    );
  });

  it('still saves the archive when the settings dialog closes mid-download', async () => {
    const download = pendingDownload();
    const { getByRole, unmount } = render(<ExportData />);

    fireEvent.click(getByRole('button'));
    await waitFor(() => expect(mockGetUserDataExport).toHaveBeenCalled());
    unmount();
    download.resolve(zipResponse);

    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
  });

  it('explains that an export is already running on 429', async () => {
    mockGetUserDataExport.mockRejectedValue({ response: { status: 429 } });
    const { getByRole } = render(<ExportData />);

    fireEvent.click(getByRole('button'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'An export is already running — please try again in a few minutes.',
        }),
      ),
    );
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('shows a generic error for other failures', async () => {
    mockGetUserDataExport.mockRejectedValue(new Error('network down'));
    const { getByRole } = render(<ExportData />);

    fireEvent.click(getByRole('button'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'The export failed. Please try again.' }),
      ),
    );
    await waitFor(() => expect(getByRole('button')).toBeEnabled());
  });
});
