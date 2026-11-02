# Engine image: computes everything (scoring, cohorts, insights) and exports the JSON
# bundles the web tier serves. Targets:
#   engine  -- exporter + pytest (default service image)
#   legacy  -- engine + Streamlit, for the original demo (compose profile "legacy")
FROM python:3.12-slim AS engine
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# one requirements file for local dev and Docker; the engine image skips the UI-only dep
COPY requirements.txt .
RUN grep -v '^streamlit' requirements.txt > /tmp/req-engine.txt \
 && pip install -r /tmp/req-engine.txt

COPY engine/ engine/
COPY tests/ tests/
# public CMS pulls cached from the last live fetch: lets the Real data bundle be
# rebuilt offline, so `docker compose up` needs no network
COPY data/ data/
# alembic.ini points at engine/db/migrations (the `migrate` service runs it)
COPY run.py pytest.ini alembic.ini ./

# bundles are written here; compose mounts a named volume on this path. Creating it in
# the image (owned by the app user) gives a fresh volume the right ownership.
RUN useradd --create-home --uid 1000 app \
 && mkdir -p web/public/data \
 && chown -R app:app /app
USER app

CMD ["python", "-m", "engine.export_web", "--offline"]


FROM engine AS legacy
USER root
RUN pip install -r requirements.txt
COPY app.py .
USER app
EXPOSE 8501
CMD ["streamlit", "run", "app.py", "--server.headless", "true", "--server.port", "8501", "--server.address", "0.0.0.0"]
