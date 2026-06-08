FROM node:18-alpine

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install npm dependencies
RUN npm install

# Copy application files
COPY . .

# Expose Vite dev port
EXPOSE 3000

# Run development server
CMD ["npm", "run", "dev"]
