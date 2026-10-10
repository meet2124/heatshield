import os
import sys

def main():
    # Attempt to load .env manually if running standalone to verify dotenv loading
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    load_dotenv(dotenv_path=env_path)

    key = os.getenv("ORS_API_KEY")
    if not key:
        print("FAIL: ORS_API_KEY is not set or is empty.")
        sys.exit(1)

    # Just check if it looks like a string of reasonable length without printing it
    if len(key) < 10:
        print("WARN: ORS_API_KEY is set but seems too short to be valid.")
        sys.exit(1)

    print("OK: ORS_API_KEY is configured and its value is hidden safely.")
    sys.exit(0)

if __name__ == "__main__":
    main()
