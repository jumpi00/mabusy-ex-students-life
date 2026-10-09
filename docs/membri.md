# Istruzioni: membri e database

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

---

# Pulire il database (ripartire da zero)

> ⚠️ **Non si può annullare.** Vengono cancellate tutte le call, le risposte e le foto.

Restano invece:

- i **membri** e chi è admin;
- gli **account** (chi è già entrato resta loggato);
- tutte le **impostazioni** (email, SMTP, URL, Realtime).

## 1. Cancellare call, risposte e foto

In **Supabase → SQL Editor**:

```sql
truncate public.calls, public.submissions, public.photos restart identity;
```

Svuota le tre tabelle e fa ripartire da 1 la numerazione interna.

## 2. Cancellare i file delle foto

Il comando sopra cancella solo i riferimenti: i file restano nello spazio di
archiviazione. Supabase non permette di cancellarli via SQL, quindi:

1. **Storage** nel menu a sinistra.
2. Passa il mouse sul contenitore **media** → clicca **⋯**.
3. **Empty bucket** → conferma.

> Non scegliere **Delete bucket**: elimina il contenitore stesso e il caricamento
> delle foto smetterebbe di funzionare.

## Dopo

Ricarica il sito: la home mostra Datasheet (0) e tutti i Materials a (0).
La prima call creata dall'Admin partirà con il solo **Selfie** come domanda
predefinita e con il numero 1.

## Cancellare una sola call

Non serve l'SQL: **Admin → Edit** sulla call → **Delete call** (in fondo, in rosso).
Si cancellano anche le risposte collegate. I file delle foto di quella call restano
nello storage; se vuoi recuperare spazio, cancella la cartella con il numero interno
della call dentro **Storage → media**.
