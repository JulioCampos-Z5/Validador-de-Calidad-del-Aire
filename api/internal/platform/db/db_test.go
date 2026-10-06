package db

import "testing"

func TestSentencias(t *testing.T) {
	sql := `-- comentario
CREATE TABLE a (
    id INT -- columna
);

CREATE TABLE b (id INT);
`
	got := sentencias(sql)
	if len(got) != 2 {
		t.Fatalf("quiero 2 sentencias, salieron %d: %q", len(got), got)
	}
}
