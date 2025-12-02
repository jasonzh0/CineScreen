# Mac Screen Recorder

A macOS screen recording application built with Electron that records your screen without the native cursor, tracks mouse movements separately, and overlays a customizable cursor in post-processing.

## Features

- Screen recording without native cursor
- Separate mouse movement tracking
- Customizable cursor overlay (size, shape, smoothing)
- Post-processing effects

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build
pnpm build

# Start built app
pnpm start

# Package for macOS
pnpm package:mac
```

## Permissions

The app requires:
- Screen Recording permission
- Accessibility permission (for mouse tracking)

These will be requested when you first run the app.

