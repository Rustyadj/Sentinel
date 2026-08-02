export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409 | 422 | 503 = 422,
  ) {
    super(message);
  }
}

export class UnsupportedRuntimeCapabilityError extends RuntimeError {
  constructor(capability: string) {
    super(
      `Runtime does not expose capability: ${capability}`,
      "runtime_does_not_expose_capability",
      422,
    );
  }
}
