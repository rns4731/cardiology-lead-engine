"""News pipeline: find articles about an employer, have Claude read them, keep only
events whose evidence quote is verbatim in the article, and turn them into the
employer-disruption signal. Real articles feed the Real data mode; fictional articles
(generated from the simulator's own events) feed Synthetic and Real-identities modes."""
