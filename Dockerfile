FROM node:20-slim

# Install build tools needed for @discordjs/opus native compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

CMD ["node", "bot.js"]
