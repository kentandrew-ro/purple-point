migrate:
	@atlas schema apply \
		--url "mysql://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?tls=false" \
		--dev-url "mysql://$(DB_DEV_USER):$(DB_DEV_PASSWORD)@$(DB_DEV_HOST):$(DB_DEV_PORT)/$(DB_DEV_NAME)?tls=false" \
		--to file://database.sql
database:
	@mariadb -h "$(DB_HOST)" -P "$(DB_PORT)" -u "$(DB_USER)" -p"$(DB_PASSWORD)" "$(DB_NAME)" --skip-ssl

atlas-database:
	@mariadb -h "$(DB_DEV_HOST)" -P "$(DB_DEV_PORT)" -u "$(DB_DEV_USER)" -p"$(DB_DEV_PASSWORD)" "$(DB_DEV_NAME)" --skip-ssl

ssh:
	@sshpass -e ssh -p "$(SSH_PORT)" "$(SSH_USER)@$(SSH_HOST)"
