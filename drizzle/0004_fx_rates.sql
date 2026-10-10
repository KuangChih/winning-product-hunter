CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"per_eur" double precision NOT NULL,
	CONSTRAINT "fx_rates_date_currency_pk" PRIMARY KEY("date","currency")
);
