"""
Smoke test for backend.lambda_handler.

Verifies that:
  1. The module imports without error.
  2. `handler` is exposed and is a Mangum instance wrapping the FastAPI app.

This test does NOT invoke Lambda; it only checks module-level wiring.
"""
import sys
import os
import unittest

# Ensure backend/ is on the path (mirrors other test files in this package)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestLambdaHandlerImport(unittest.TestCase):
    def test_handler_is_exposed(self):
        """lambda_handler.handler must exist after import."""
        import lambda_handler  # noqa: F401 — import side-effects are the point
        self.assertTrue(
            hasattr(lambda_handler, "handler"),
            "lambda_handler module must expose a 'handler' attribute",
        )

    def test_handler_is_mangum_instance(self):
        """handler must be a Mangum callable."""
        from mangum import Mangum
        import lambda_handler

        self.assertIsInstance(
            lambda_handler.handler,
            Mangum,
            "handler must be a Mangum instance",
        )

    def test_handler_wraps_fastapi_app(self):
        """Mangum handler must wrap the FastAPI app from main.py."""
        import lambda_handler
        from main import app

        # Mangum stores the ASGI app on .app
        self.assertIs(
            lambda_handler.handler.app,
            app,
            "Mangum handler must wrap the same FastAPI app object from main.py",
        )


if __name__ == "__main__":
    unittest.main()
