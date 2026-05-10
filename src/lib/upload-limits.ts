export const MAX_UPLOAD_FILES = 8;
export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;

type UploadFileLike = {
  name?: string;
  size: number;
  type?: string;
};

export type UploadValidationError = {
  message: string;
};

export function validateUploadFiles(files: UploadFileLike[]): UploadValidationError | null {
  if (files.length > MAX_UPLOAD_FILES) {
    return { message: `Too many files. Upload up to ${MAX_UPLOAD_FILES} images at a time.` };
  }

  for (const file of files) {
    const name = file.name || 'upload';
    const mimeType = (file.type || '').toLowerCase();

    if (file.size <= 0) {
      return { message: `${name} is empty. Upload a non-empty image file.` };
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      return { message: `${name} is too large. Each image must be 25 MB or smaller.` };
    }

    if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
      return { message: `${name} must be a supported image file.` };
    }
  }

  return null;
}
