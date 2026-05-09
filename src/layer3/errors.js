export class Layer3Error extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'Layer3Error';
    this.details = details;
  }
}

export class Layer3ValidationError extends Layer3Error {
  constructor(message, details = []) {
    super(message, details);
    this.name = 'Layer3ValidationError';
  }
}

export function validationIssue(field, code, message) {
  return { field, code, message };
}
