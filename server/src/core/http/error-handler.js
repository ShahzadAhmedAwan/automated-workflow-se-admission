import { AppError } from '../errors/app-error.js';

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested page or resource was not found.'));
}

/**
 * Formats Zod schema validation errors into a single, clean, plain-English sentence
 * so non-technical users immediately understand what field needs attention.
 */
export function formatZodError(error) {
  if (!error?.issues || !Array.isArray(error.issues) || error.issues.length === 0) {
    return 'Please check the information you entered and try again.';
  }

  const fieldLabels = {
    campaignId: 'Campaign',
    fullName: 'Full name',
    fatherName: 'Father name',
    phone: 'Phone number',
    email: 'Email address',
    cnic: 'CNIC',
    city: 'City / Domicile',
    priorDegree: 'Prior degree',
    fscMarks: 'FSc marks',
    matricMarks: 'Matric marks',
    hasMaths: 'Mathematics background',
    password: 'Password',
    displayName: 'Display name',
    roleId: 'User role',
    status: 'Status',
    notes: 'Review notes',
    action: 'Decision action',
    reason: 'Reason',
    sourceType: 'Source type',
    boardName: 'Board name',
    academicYear: 'Academic year',
    customGreeting: 'Custom greeting',
    content: 'Content',
    title: 'Title',
  };

  const formattedIssues = error.issues.map((issue) => {
    // Check if the issue has a generic default message from Zod (supports both Zod 3 and Zod 4)
    const isGenericDefaultMessage =
      !issue.message ||
      issue.message === 'Required' ||
      issue.message.startsWith('Expected ') ||
      issue.message.startsWith('Invalid input') ||
      issue.message.startsWith('String must contain') ||
      issue.message.startsWith('Number must be') ||
      issue.message.startsWith('Array must contain') ||
      issue.message.startsWith('Too small') ||
      issue.message.startsWith('Too big');

    // If the schema provided a specific human-friendly custom message, use it directly
    if (issue.message && !isGenericDefaultMessage) {
      return issue.message;
    }

    const fieldName = issue.path[issue.path.length - 1];
    const label = fieldLabels[fieldName] || (fieldName ? String(fieldName).replace(/([A-Z])/g, ' $1').toLowerCase() : 'field');
    const isStringType = issue.type === 'string' || issue.origin === 'string';

    const isMissing =
      issue.code === 'invalid_type' &&
      (issue.received === 'undefined' ||
        issue.received === 'null' ||
        issue.received === 'nan' ||
        issue.received === 'NaN' ||
        issue.message?.includes('received undefined') ||
        issue.message?.includes('received NaN') ||
        issue.message?.includes('received null'));

    if (isMissing) {
      if (fieldName === 'campaignId') {
        return 'Campaign selection is required.';
      }
      return `${label.charAt(0).toUpperCase() + label.slice(1)} is required.`;
    }
    if (issue.code === 'too_small') {
      if (isStringType) {
        return `${label.charAt(0).toUpperCase() + label.slice(1)} must be at least ${issue.minimum} characters.`;
      }
      return `${label.charAt(0).toUpperCase() + label.slice(1)} is below the minimum allowed value.`;
    }
    if (issue.code === 'too_big') {
      if (isStringType) {
        return `${label.charAt(0).toUpperCase() + label.slice(1)} cannot exceed ${issue.maximum} characters.`;
      }
      return `${label.charAt(0).toUpperCase() + label.slice(1)} exceeds the maximum allowed value.`;
    }
    if (issue.message) {
      return `${label.charAt(0).toUpperCase() + label.slice(1)}: ${issue.message}`;
    }
    return `Please provide a valid ${label}.`;
  });

  const unique = [...new Set(formattedIssues)];
  return unique.join(' ');
}

/**
 * Resolves technical system errors into polite, plain-English user messages.
 */
export function resolveFriendlyError(error) {
  // 1. Zod Validation Errors
  if (error?.name === 'ZodError' || Array.isArray(error?.issues)) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: formatZodError(error),
    };
  }

  // 2. Multer / File Upload Errors
  if (error?.name === 'MulterError' || error?.message?.includes('Only CSV files are allowed')) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        message: 'The selected file is too large. Please upload a file smaller than 10 MB.',
      };
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return {
        status: 400,
        code: 'UNEXPECTED_FILE',
        message: 'An unexpected file field was uploaded. Please use the designated file upload buttons.',
      };
    }
    if (error.message?.includes('Only CSV files are allowed')) {
      return {
        status: 400,
        code: 'INVALID_FILE_TYPE',
        message: 'Please select a valid CSV spreadsheet (.csv) to upload.',
      };
    }
    return {
      status: 400,
      code: 'FILE_UPLOAD_ERROR',
      message: 'There was a problem uploading your file. Please check the file and try again.',
    };
  }

  // 3. JSON body parsing error
  if (error?.type === 'entity.parse.failed') {
    return {
      status: 400,
      code: 'INVALID_JSON',
      message: 'The submitted information was not formatted properly. Please refresh the page and try again.',
    };
  }

  // 4. Request payload too large
  if (error?.type === 'entity.too.large') {
    return {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The submitted request exceeds the permitted size limit. Please upload a smaller file or reduce the payload.',
    };
  }

  // 5. Database errors
  if (error?.code === 'ER_DUP_ENTRY') {
    return {
      status: 409,
      code: 'DUPLICATE_ENTRY',
      message: 'A record with this information already exists in the system.',
    };
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'PROTOCOL_CONNECTION_LOST' || error?.code === 'ETIMEDOUT') {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The admissions database service is temporarily unavailable. Please try again in a few moments.',
    };
  }
  if (error?.code === 'ER_NO_REFERENCED_ROW_2') {
    return {
      status: 400,
      code: 'INVALID_REFERENCE',
      message: 'The selected related record was not found. Please review your selection.',
    };
  }
  if (error?.code === 'ER_ROW_IS_REFERENCED_2') {
    return {
      status: 400,
      code: 'RECORD_IN_USE',
      message: 'This record cannot be deleted because other active records depend on it.',
    };
  }

  // 6. Known AppError
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  // 7. General internal errors
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong while processing your request. Please try again in a few moments.',
  };
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  const requestId = req.requestId ?? 'unavailable';

  // Log full technical details on server console for developers
  const isKnown = error instanceof AppError || error?.name === 'ZodError' || error?.type === 'entity.parse.failed';
  if (!isKnown) {
    console.error(`[${requestId}] ${req.method} ${req.path} failed:`, error);
  }

  const { status, code, message } = resolveFriendlyError(error);

  res.status(status).json({
    error: {
      code,
      message,
    },
    requestId,
  });
}
