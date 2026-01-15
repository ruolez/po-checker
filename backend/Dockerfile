FROM python:3.11-slim

# Install FreeTDS and build dependencies for pymssql
RUN apt-get update && apt-get install -y \
    freetds-dev \
    freetds-bin \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Set environment variables
ENV FLASK_APP=app.main:app
ENV PYTHONUNBUFFERED=1

EXPOSE 5000

# Run with hot reload for development
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000", "--reload"]
