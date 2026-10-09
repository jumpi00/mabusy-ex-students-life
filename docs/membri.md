# Gestire i membri del gruppo

Chi può entrare nel sito è deciso dalla tabella `members` su Supabase.
L'**email è la chiave** di ogni persona: è quella che il sito usa per riconoscerla.

Tutti i comandi qui sotto si lanciano in **Supabase → SQL Editor**.
Sostituisci sempre gli indirizzi di esempio con quelli veri.

---

## Cambiare l'email di una persona

```sql
update public.members
set email = 'nuova@email.com'
where email = 'vecchia@email.com';
```

> ⚠️ Non rilanciare lo script di inserimento con l'email nuova: creerebbe una
> **seconda riga** e la persona comparirebbe due volte nel sito.

Dopo il cambio:

1. La persona deve **rientrare** dalla pagina di login usando l'email nuova.
2. I contenuti caricati con la vecchia email restano legati al vecchio account
   (se vuoi tenerli, chiedi prima di cambiare).
3. Aggiorna anche il file locale `sql/002_members.local.sql`, così una futura
   riesecuzione non riporta indietro l'email vecchia.

---

## Controllare la lista

```sql
select email, name, is_admin, sort
from public.members
order by sort;
```

Ogni persona deve comparire **una volta sola**.

---

## Rimuovere un doppione o una persona

```sql
delete from public.members where email = 'email@da.rimuovere';
```

La persona non potrà più vedere nulla nel sito (i contenuti che ha caricato restano
nel database, ma non sono più collegati a un membro).

---

## Aggiungere una persona

```sql
insert into public.members (email, name, is_admin, sort)
values ('nuova.persona@email.com', 'Nome', false, 6);
```

- `name`: il nome mostrato nel sito.
- `is_admin`: `true` solo per chi deve creare e gestire le call.
- `sort`: la posizione nelle liste (1 = prima).

---

## Cambiare nome, ordine o admin

```sql
update public.members
set name = 'Nuovo nome', sort = 3, is_admin = false
where email = 'persona@email.com';
```

---

## Dove sono le email

- Le email esistono **solo** in Supabase e nel file locale
  `sql/002_members.local.sql` sul computer dell'admin.
- Quel file è escluso da git (regola `*.local.sql` in `.gitignore`)
  e **non è mai stato pubblicato** su GitHub.
- Non scrivere email vere in nessun altro file del progetto: il repository è pubblico.
