class ApiError(Exception):
    def __init__(self, code: str, message: str, fields=None, status_code=422):
        self.code = code
        self.message = message
        self.fields = fields or []
        self.status_code = status_code
        super().__init__(message)
