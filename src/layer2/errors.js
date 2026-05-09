export class Layer2Error extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'Layer2Error';
    this.details = details;
  }
}

export class Layer2ValidationError extends Layer2Error {
  constructor(message, details = []) {
    super(message, details);
    this.name = 'Layer2ValidationError';
  }
}

export function validationIssue(field, code, message) {
  return { field, code, message };
}
