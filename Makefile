.PHONY: docker-run-postgres
docker-run-postgres:
	docker run -d \
	  --name postgres \
	  --restart unless-stopped \
	  -e POSTGRES_USER=postgres \
	  -e POSTGRES_PASSWORD=postgres \
	  -e POSTGRES_DB=db \
	  -v postgres_data:/var/lib/postgresql \
	  --memory 1g \
	  -p 5432:5432 \
	  --health-cmd "pg_isready -U postgres -d db" \
	  --health-interval 10s \
	  --health-timeout 5s \
	  --health-retries 5 \
	  postgres:18