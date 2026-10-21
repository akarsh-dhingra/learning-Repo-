/*
 * Reusable quiz component.
 *
 * Markup:
 *   <div class="quiz" data-explain="Why the answer is right.">
 *     <p class="q">Question?</p>
 *     <div class="opts">
 *       <button class="opt">Option one</button>
 *       <button class="opt" data-correct>Option two</button>
 *     </div>
 *   </div>
 *
 * Options are shuffled on load (add data-fixed to the .quiz to keep order,
 * e.g. for hit/miss drills). First click locks the question and shows feedback.
 * A <p class="score" data-for="SECTION_ID"></p> anywhere shows the tally for
 * quizzes inside the element with that id.
 */
(function () {
  function shuffle(el) {
    const kids = Array.from(el.children);
    for (let i = kids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [kids[i], kids[j]] = [kids[j], kids[i]];
    }
    kids.forEach((k) => el.appendChild(k));
  }

  function updateScores() {
    document.querySelectorAll(".score[data-for]").forEach((s) => {
      const scope = document.getElementById(s.dataset.for);
      if (!scope) return;
      const all = scope.querySelectorAll(".quiz");
      const done = scope.querySelectorAll(".quiz[data-done]");
      const right = scope.querySelectorAll('.quiz[data-done="right"]');
      s.textContent = `${right.length} / ${all.length} correct` + (done.length < all.length ? ` · ${all.length - done.length} to go` : "");
    });
  }

  document.querySelectorAll(".quiz").forEach((quiz) => {
    const opts = quiz.querySelector(".opts");
    if (!quiz.hasAttribute("data-fixed")) shuffle(opts);
    const fb = document.createElement("p");
    fb.className = "fb";
    fb.setAttribute("aria-live", "polite");
    quiz.appendChild(fb);

    opts.querySelectorAll("button.opt").forEach((btn) => {
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (quiz.dataset.done) return;
        const ok = btn.hasAttribute("data-correct");
        quiz.dataset.done = ok ? "right" : "wrong";
        btn.classList.add(ok ? "right" : "wrong");
        opts.querySelectorAll("button.opt").forEach((b) => {
          if (b.hasAttribute("data-correct")) b.classList.add("right");
          b.disabled = true;
        });
        fb.className = "fb " + (ok ? "right" : "wrong");
        fb.textContent = (ok ? "Correct. " : "Not quite. ") + (quiz.dataset.explain || "");
        updateScores();
      });
    });
  });
  updateScores();
})();
