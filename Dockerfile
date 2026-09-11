FROM python:3.12-alpine

RUN adduser -D -u 10001 app
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

USER app
CMD ["python", "-m", "bicikelj_log"]
