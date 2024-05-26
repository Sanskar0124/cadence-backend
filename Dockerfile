# syntax=docker/dockerfile:1
FROM node:lts-alpine

COPY ./cadence-brain ./Cadence-Brain
COPY ./cadence-proto  ./cadence-proto
COPY . ./CRM-Backend
WORKDIR /Cadence-Brain
RUN npm install --production
WORKDIR /CRM-Backend
ENV NODE_ENV=production
RUN npm install --production

CMD ["node", "src/index.js"]