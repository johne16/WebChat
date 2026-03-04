# Use official Playwright image (has browser deps pre-installed)
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browser
RUN playwright install chromium

# Copy application code
COPY src/ ./src/
COPY prompts/ ./prompts/

# Create logs directory
RUN mkdir -p logs/generated_code

# Expose port
EXPOSE 5001

# Set environment variables (override with --env-file)
ENV PORT=5001
ENV DEBUG=false
ENV HEADLESS=true

# Run the application
CMD ["python", "-m", "src.agent_service"]
