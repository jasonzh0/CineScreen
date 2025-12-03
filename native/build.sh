#!/bin/bash

# Build script for mouse-button-state binary
# This compiles the Swift script into a standalone binary

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SWIFT_FILE="$SCRIPT_DIR/mouse-button-state.swift"
OUTPUT_FILE="$SCRIPT_DIR/mouse-button-state"

# Compile Swift script to binary
swiftc -o "$OUTPUT_FILE" "$SWIFT_FILE" -framework CoreGraphics

if [ $? -eq 0 ]; then
    echo "Successfully built mouse-button-state binary"
    chmod +x "$OUTPUT_FILE"
else
    echo "Failed to build mouse-button-state binary"
    exit 1
fi



