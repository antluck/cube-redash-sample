FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir duckdb buenavista pyarrow python-dateutil

COPY serve.py .

EXPOSE 5433

CMD ["python3", "serve.py"]
