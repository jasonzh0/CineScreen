# CineScreen Electron Builder Docker Image
# Uses electron-userland/builder:wine for cross-platform builds

FROM electronuserland/builder:wine

# Set working directory
WORKDIR /project

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the project
COPY . .

# Build TypeScript and renderer
RUN npm run build

# Default command: build for Windows
CMD ["npm", "run", "package:win"]
