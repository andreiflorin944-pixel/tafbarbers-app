// Cât timp clientul citește/semnează termenii sau completează intrarea în cont, actualizarea rapidă NU repornește aplicația
// (altfel fereastra s-ar închide în mijlocul cititului). Se aplică la următoarea revenire, după ce a terminat.
let holds = 0;

/** Oprește repornirea până la apelul funcției întoarse. */
export function holdReload(): () => void {
  holds++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds--;
  };
}

export const reloadHeld = () => holds > 0;
