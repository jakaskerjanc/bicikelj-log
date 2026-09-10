FROM python:3.12-slim

RUN useradd --create-home --uid 10001 app
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

USER app
CMD ["python", "-m", "bicikelj_log"]
