# UPS-only CAPM Project

This project reads and writes `ZPLANT_LOCATION` directly through the `DS_INTEGRATION` UPS binding.

## Notes

- The target table defaults to `ZPLANT_LOCATION`.
- Override with env vars if needed:
  - `UPS_SERVICE_NAME`
  - `UPS_TARGET_SCHEMA`
  - `UPS_TARGET_TABLE`
