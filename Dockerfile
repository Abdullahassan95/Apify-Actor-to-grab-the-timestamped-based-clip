# Use a newer Debian-based Node image (includes Python 3.11)
FROM node:20-bookworm-slim

# Install ffmpeg and python3-pip for yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3-pip \
    python3 \
    && pip3 install yt-dlp --break-system-packages \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --omit=dev

# Copy source
COPY . ./

# Run the actor
CMD ["node", "main.js"]
