# syntax=docker/dockerfile:1

# ---- base: shared dependency install layer ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- dev: docker-compose `dev` profile target ----
# Runs the Vite dev server directly. Build with `docker build --target dev`.
# Source is expected to be bind-mounted over /app by docker-compose for live reload.
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build: docker-compose `prod` profile target ----
# Produces a static build at /app/dist. Build with `docker build --target build`,
# then copy /app/dist into the nginx image/volume for the prod profile.
FROM base AS build
COPY . .
RUN npm run build
