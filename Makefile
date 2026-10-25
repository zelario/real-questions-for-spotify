.PHONY: all build run

all: build run

build:
	docker compose build

run:
	docker compose up

