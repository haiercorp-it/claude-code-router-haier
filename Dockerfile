FROM node:20-alpine

RUN npm install -g @haier/claude-code-router

EXPOSE 3456

CMD ["ccr",  "start"]
