import { useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cookie,
  Heart,
  Lightbulb,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const images = {
  logo: `${basePath}/images/amore-logo.png`,
  package: `${basePath}/images/amore-cookie-package.png`,
  cookie: `${basePath}/images/amore-cookie.jpg`,
  baker: `${basePath}/images/amore-baker-mascot.png`,
};

const navItems = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#rewards', label: 'The rewards' },
  { href: '#community', label: 'Our kind of people' },
  { href: '#questions', label: 'Questions' },
];

const faqs = [
  {
    question: 'What counts as a flavor idea?',
    answer:
      'A point of view, a pairing, a memory, a little what-if. It can begin with a familiar favorite or something nobody has tried in a cookie yet. The best ideas give us a feeling as well as a flavor.',
  },
  {
    question: 'How do KWD rewards work?',
    answer:
      'When an idea is selected and goes on to become a successful Amore product, its creator receives a reward in Kuwaiti dinars. The reward terms and what “successful” means will be clearly shared before any idea is submitted. No surprises in the small print.',
  },
  {
    question: 'Do I need to be a professional baker?',
    answer:
      'Not at all. This is for the person who always has a new cookie thought, the serious home baker, the flavor chaser, and everyone in between. Curiosity is plenty.',
  },
  {
    question: 'Is the flavor community open right now?',
    answer:
      'This page introduces the community and how it will work. Idea submissions and reward participation are not open yet. We’ll share the full rules and next steps before the program begins.',
  },
];

function Wordmark() {
  return (
    <a className="focus-ring flex items-center gap-2.5" href="#top" aria-label="Amore Flavor Rewards home">
      <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-[#e9bdca] bg-[#5B0D1E]">
        <img src={images.logo} alt="" className="h-full w-full object-cover scale-[1.35]" />
      </span>
      <span className="leading-none">
        <span className="block font-display text-[21px] italic tracking-[-.04em] text-[#5B0D1E]">Amore</span>
        <span className="mt-1 block text-[8px] font-bold uppercase tracking-[.19em] text-[#9d5367]">Flavor Rewards</span>
      </span>
    </a>
  );
}

function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenu = () => setMobileOpen(false);

  return (
    <div className="noise min-h-[100dvh] overflow-hidden bg-[#fbf5ed] text-[#45101d]">
      <header className="sticky top-0 z-30 border-b border-[#5b0d1e]/10 bg-[#fbf5ed]/95 backdrop-blur-md">
        <div className="container-wide flex h-[76px] items-center justify-between gap-5">
          <Wordmark />
          <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
            {navItems.map((item) => (
              <a key={item.href} className="focus-ring text-[10px] font-semibold tracking-[.04em] text-[#76525c] transition-colors hover:text-[#5B0D1E]" href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <a className="btn-primary focus-ring hidden !px-5 !py-3 sm:inline-flex" href="#how-it-works">
            Explore the idea <ArrowRight size={14} />
          </a>
          <button
            className="focus-ring grid h-10 w-10 place-items-center rounded-full text-[#5B0D1E] md:hidden"
            type="button"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {mobileOpen && (
          <nav className="grid gap-1 border-t border-[#5b0d1e]/10 bg-[#fbf5ed] px-5 py-3 md:hidden" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} onClick={closeMenu} className="focus-ring rounded-xl px-3 py-3 text-sm font-medium text-[#5B0D1E] hover:bg-[#f5e7df]">
                {item.label}
              </a>
            ))}
            <a href="#how-it-works" onClick={closeMenu} className="btn-primary mt-1 justify-center">Explore the idea <ArrowRight size={14} /></a>
          </nav>
        )}
      </header>

      <main>
        <section id="top" className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-24 top-[-10rem] h-[36rem] w-[36rem] rounded-full bg-[#f8d5df]/65" />
          <div className="pointer-events-none absolute bottom-[-16rem] left-[-12rem] h-[34rem] w-[34rem] rounded-full border border-[#5B0D1E]/10" />
          <div className="container-wide relative grid min-h-[670px] items-center gap-9 py-14 md:grid-cols-[1.04fr_.96fr] md:py-16 lg:min-h-[740px]">
            <div className="relative z-10 max-w-[620px]">
              <div className="rise mb-6 inline-flex items-center gap-2 rounded-full border border-[#5B0D1E]/15 bg-[#fffaf4]/75 px-3.5 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b85570]" />
                <span className="text-[9px] font-bold uppercase tracking-[.19em] text-[#8d5261]">A little community with a big sweet tooth</span>
              </div>
              <h1 className="rise delay-1 font-display text-[clamp(52px,8vw,106px)] leading-[.91] tracking-[-.065em] text-[#5B0D1E]">
                Your flavor<br />
                <span className="serif-italic font-medium text-[#b64e6b]">could be</span><br />
                <span className="relative">the one.</span>
              </h1>
              <p className="rise delay-2 mt-7 max-w-[435px] text-[13px] leading-[1.9] text-[#76525c] md:text-[14px]">
                Have a cookie idea you can’t stop thinking about? Bring it to Amore. The right flavor can find its way from your imagination to a real product — with a clear KWD reward when it succeeds.
              </p>
              <div className="rise delay-3 mt-8 flex flex-wrap items-center gap-3">
                <a className="btn-primary focus-ring" href="#how-it-works">See how it works <ArrowRight size={15} /></a>
                <a className="focus-ring inline-flex items-center gap-2 px-3 py-3 text-[11px] font-bold text-[#5B0D1E] underline decoration-[#d9aab7] underline-offset-4 transition-colors hover:text-[#a1435d]" href="#rewards">
                  How rewards stay fair <ArrowUpRight size={14} />
                </a>
              </div>
              <div className="mt-11 flex items-center gap-4 border-t border-[#5b0d1e]/12 pt-5">
                <div className="flex -space-x-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#fbf5ed] bg-[#f5d4dd] text-[#5B0D1E]"><Heart size={13} fill="currentColor" /></span>
                  <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#fbf5ed] bg-[#e7c3a7] text-[#5B0D1E]"><Cookie size={14} /></span>
                  <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#fbf5ed] bg-[#5B0D1E] text-[#fff3ea]"><Sparkles size={13} /></span>
                </div>
                <p className="text-[10px] font-medium leading-relaxed text-[#80616a]">For the flavor dreamers,<br /><span className="font-bold text-[#5B0D1E]">not just the professional bakers.</span></p>
              </div>
            </div>

            <div className="relative mx-auto flex min-h-[420px] w-full max-w-[560px] items-center justify-center md:min-h-[560px]">
              <div className="absolute left-[8%] top-[9%] h-[78%] w-[78%] rounded-full border border-[#5B0D1E]/15" />
              <div className="absolute left-[13%] top-[14%] h-[68%] w-[68%] rounded-full bg-[#f6d1db]" />
              <div className="absolute right-[4%] top-[8%] rotate-12 text-[#a6536c]">
                <span className="block font-display text-[12px] italic">made for</span>
                <span className="block font-display text-[15px] italic">what if?</span>
              </div>
              <img
                className="float-gently relative z-[2] w-[69%] max-w-[390px] drop-shadow-[0_22px_18px_rgba(91,13,30,.16)]"
                src={images.package}
                alt="Amore Cookies package, the delicious starting point for a new flavor"
              />
              <div className="absolute bottom-[8%] left-[0%] z-[3] -rotate-6 rounded-full border border-[#eed8d1] bg-[#fffaf4] px-5 py-3 shadow-[0_15px_30px_rgba(91,13,30,.12)]">
                <span className="block text-[8px] font-bold uppercase tracking-[.18em] text-[#a6536c]">A real idea</span>
                <span className="mt-1 block font-display text-[18px] italic text-[#5B0D1E]">starts with a bite.</span>
              </div>
              <div className="absolute bottom-[0%] right-[5%] z-[3] w-[120px] rotate-[7deg] md:w-[145px]">
                <img className="w-full drop-shadow-[0_10px_16px_rgba(91,13,30,.12)]" src={images.baker} alt="Amore's baker mascot bringing a plate of cookies" />
              </div>
              <span className="absolute bottom-[15%] right-[2%] font-display text-[12px] italic text-[#a6536c]">a sweeter kind of collaboration</span>
            </div>
            <a href="#how-it-works" className="focus-ring absolute bottom-5 left-1/2 hidden -translate-x-1/2 items-center gap-2 text-[9px] font-bold uppercase tracking-[.19em] text-[#9d5367] md:flex">
              Take a closer look <ArrowDown size={13} />
            </a>
          </div>
        </section>

        <div className="border-y border-[#5b0d1e]/10 bg-[#f5e8dc]">
          <div className="container-wide flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-4 text-center text-[9px] font-bold uppercase tracking-[.16em] text-[#79535d] md:justify-between">
            <span className="inline-flex items-center gap-2"><Lightbulb size={14} className="text-[#a94e68]" /> Your imagination, first</span>
            <span className="hidden h-1 w-1 rounded-full bg-[#c28b98] md:block" />
            <span className="inline-flex items-center gap-2"><ShieldCheck size={14} className="text-[#a94e68]" /> Clear terms, before you share</span>
            <span className="hidden h-1 w-1 rounded-full bg-[#c28b98] md:block" />
            <span className="inline-flex items-center gap-2"><CircleDollarSign size={14} className="text-[#a94e68]" /> Rewards in KWD</span>
          </div>
        </div>

        <section id="how-it-works" className="section-pad container-wide">
          <div className="grid gap-10 md:grid-cols-[.8fr_1.2fr] md:items-end">
            <div>
              <span className="eyebrow">From “what if” to “where can I get one?”</span>
              <h2 className="serif mt-4 max-w-[480px] text-[clamp(39px,5vw,62px)] leading-[1.03] tracking-[-.045em] text-[#5B0D1E]">
                A good idea deserves a <span className="serif-italic text-[#b64e6b]">real shot.</span>
              </h2>
            </div>
            <p className="mb-1 max-w-[440px] text-[12px] leading-7 text-[#76525c] md:justify-self-end">
              Flavor making is a team sport. You bring the spark; the Amore kitchen brings the craft. Here’s the simple path an idea can take.
            </p>
          </div>
          <div className="mt-12 grid border-y border-[#5b0d1e]/15 md:grid-cols-3">
            {[
              { number: '01', title: 'Dream it up', copy: 'A nostalgic dessert, a surprising crunch, a flavor from home. Start with the thing you wish existed.', icon: <Lightbulb size={19} /> },
              { number: '02', title: 'Make it together', copy: 'If your idea is selected, Amore works through the details and turns that first spark into a testable cookie.', icon: <Cookie size={19} /> },
              { number: '03', title: 'Share the sweet', copy: 'If the idea becomes a successful product, you receive the clearly agreed reward in Kuwaiti dinars.', icon: <CircleDollarSign size={19} /> },
            ].map((step, index) => (
              <article key={step.number} className={`group relative py-8 md:px-7 md:py-9 ${index > 0 ? 'border-t border-[#5b0d1e]/15 md:border-l md:border-t-0' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="font-display text-[14px] italic text-[#bb7889]">{step.number}</span>
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#f4dce0] text-[#8d3049] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">{step.icon}</span>
                </div>
                <h3 className="mt-7 font-display text-[25px] tracking-[-.025em] text-[#5B0D1E]">{step.title}</h3>
                <p className="mt-3 max-w-[300px] text-[11px] leading-[1.9] text-[#80616a]">{step.copy}</p>
              </article>
            ))}
          </div>
          <p className="mt-5 text-[9px] leading-5 text-[#9a747c]">This page explains the planned community experience. Flavor submissions are not open yet.</p>
        </section>

        <section id="rewards" className="relative overflow-hidden bg-[#5B0D1E] text-[#fff7f2]">
          <div className="pointer-events-none absolute -right-28 -top-32 h-[450px] w-[450px] rounded-full border border-[#f6cedb]/20" />
          <div className="pointer-events-none absolute -right-12 -top-16 h-[330px] w-[330px] rounded-full border border-[#f6cedb]/20" />
          <div className="container-wide relative grid gap-12 py-20 md:grid-cols-[1fr_.8fr] md:items-center md:py-24">
            <div>
              <span className="eyebrow !text-[#f3b9c9]">Good ideas should be treated well</span>
              <h2 className="serif mt-4 max-w-[570px] text-[clamp(43px,6vw,72px)] leading-[.99] tracking-[-.05em]">
                Sweet ideas.<br /><span className="serif-italic text-[#f3b9c9]">Straightforward</span> rewards.
              </h2>
              <p className="mt-6 max-w-[475px] text-[12px] leading-7 text-[#f0d1d7]">
                If your idea becomes a successful Amore product, your reward is paid in Kuwaiti dinars. The amount, criteria, and terms will be made clear up front — before your idea is ever submitted.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a className="btn-light focus-ring" href="#questions">What “successful” means <ArrowRight size={14} /></a>
                <a className="focus-ring inline-flex items-center gap-2 rounded-full px-4 py-3 text-[10px] font-bold text-[#f4c7d1] underline decoration-[#b97889] underline-offset-4" href="#community">Meet the community <ArrowUpRight size={13} /></a>
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-[410px]">
              <div className="grain-card soft-shadow rounded-[28px] border border-[#fff2ec]/20 bg-[#6c1b30] p-7 md:p-9">
                <div className="relative z-[1] flex items-center justify-between border-b border-[#f6cedb]/20 pb-5">
                  <span className="text-[9px] font-bold uppercase tracking-[.19em] text-[#f3b9c9]">The promise</span>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f5d5de] text-[#5B0D1E]"><ShieldCheck size={17} /></span>
                </div>
                <div className="relative z-[1] mt-7 font-display text-[30px] leading-tight">No mystery math.</div>
                <p className="relative z-[1] mt-3 text-[11px] leading-6 text-[#f2d4dc]">The reward and the success criteria are shared in KWD, in plain language, before participation.</p>
                <div className="relative z-[1] mt-7 space-y-4">
                  {['KWD reward, clearly stated', 'Success criteria shared upfront', 'No payment for ideas that don’t qualify'].map((item) => (
                    <div key={item} className="flex gap-3 text-[10px] font-medium text-[#fff2ed]">
                      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[#f5d5de] text-[#5B0D1E]"><Check size={11} strokeWidth={3} /></span>{item}
                    </div>
                  ))}
                </div>
                <div className="relative z-[1] mt-8 border-t border-[#f6cedb]/20 pt-5">
                  <span className="text-[8px] font-bold uppercase tracking-[.16em] text-[#e7aebe]">Built on clarity</span>
                  <p className="mt-1 font-display text-[17px] italic text-[#fff3ef]">Because trust is part of the recipe.</p>
                </div>
              </div>
              <span className="absolute -bottom-5 -left-6 z-10 grid h-16 w-16 rotate-[-11deg] place-items-center rounded-full bg-[#f5d5de] text-[#5B0D1E] shadow-xl">
                <span className="text-center font-display text-[11px] italic leading-tight">made with<br />good faith</span>
              </span>
            </div>
          </div>
        </section>

        <section id="community" className="section-pad container-wide">
          <div className="grid gap-12 md:grid-cols-[.86fr_1.14fr] md:items-center">
            <div className="relative mx-auto w-full max-w-[470px]">
              <div className="absolute inset-4 rotate-3 rounded-[42%_58%_54%_46%/45%_40%_60%_55%] bg-[#f3d4d5]" />
              <div className="relative overflow-hidden rounded-[42%_58%_54%_46%/45%_40%_60%_55%] border-[9px] border-[#f3d4d5] bg-[#ead2c2]">
                <img src={images.cookie} alt="A close-up of a chunky Amore chocolate chip cookie" className="aspect-[.95] w-full object-cover" loading="lazy" />
              </div>
              <div className="absolute -bottom-2 -right-1 w-[100px] rotate-6 rounded-2xl bg-[#fffaf4] p-2 shadow-xl md:right-1 md:w-[126px]">
                <img src={images.baker} alt="" className="w-full" loading="lazy" />
                <p className="pb-1 text-center font-display text-[11px] italic text-[#5B0D1E]">good taste is shared</p>
              </div>
              <span className="absolute -left-1 top-10 rotate-[-12deg] font-display text-[15px] italic text-[#9c5265]">made for sharing</span>
            </div>
            <div className="md:pl-7">
              <span className="eyebrow">For the ones who always have a flavor thought</span>
              <h2 className="serif mt-4 text-[clamp(40px,5vw,62px)] leading-[1.02] tracking-[-.045em] text-[#5B0D1E]">
                The “wait, what if we put <span className="serif-italic text-[#b64e6b]">this</span> in a cookie?” people.
              </h2>
              <p className="mt-5 max-w-[500px] text-[12px] leading-7 text-[#76525c]">
                You know who you are. You collect the best bites, remember the dessert from that one trip, and think about the perfect salty-sweet balance long after the plate is empty.
              </p>
              <div className="mt-8 space-y-4">
                {[
                  ['The nostalgia baker', 'A taste that brings a story with it.'],
                  ['The fearless tinkerer', 'A little crunch where nobody expects it.'],
                  ['The generous friend', 'A flavor that makes people say, “try this.”'],
                ].map(([name, detail]) => (
                  <div key={name} className="flex items-start gap-3 border-b border-[#5b0d1e]/12 pb-4">
                    <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#f5dce0] text-[#a34761]"><Heart size={12} /></span>
                    <p className="text-[11px] leading-5 text-[#80616a]"><span className="font-bold text-[#5B0D1E]">{name}.</span> {detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-[#f3dbe0]">
          <div className="container-wide grid gap-8 py-16 md:grid-cols-[1fr_auto] md:items-center md:py-20">
            <div className="max-w-[720px]">
              <span className="eyebrow">The next great cookie starts somewhere</span>
              <h2 className="serif mt-3 text-[clamp(39px,5vw,62px)] leading-[1.04] tracking-[-.045em] text-[#5B0D1E]">
                Maybe it starts with <span className="serif-italic text-[#a54760]">you.</span>
              </h2>
              <p className="mt-4 max-w-[560px] text-[11px] leading-6 text-[#76525c]">For now, take a look around and get to know the idea. We’ll share the participation details when the program is ready — no sign-up or submission needed here.</p>
            </div>
            <a className="btn-primary focus-ring justify-self-start md:justify-self-end" href="#top">Back to the top <ArrowUpRight size={14} /></a>
          </div>
        </section>

        <section id="questions" className="section-pad container-wide">
          <div className="grid gap-9 md:grid-cols-[.7fr_1.3fr]">
            <div>
              <span className="eyebrow">A few good things to know</span>
              <h2 className="serif mt-4 text-[42px] leading-[1.05] tracking-[-.04em] text-[#5B0D1E]">Questions, <span className="serif-italic text-[#b64e6b]">answered.</span></h2>
              <p className="mt-4 max-w-[300px] text-[11px] leading-6 text-[#80616a]">A little more about what this community is — and what it isn’t just yet.</p>
            </div>
            <div className="divide-y divide-[#5b0d1e]/15 border-y border-[#5b0d1e]/15">
              {faqs.map((faq, index) => (
                <details key={faq.question} className="group py-5" open={index === 0}>
                  <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-5 text-left text-[12px] font-bold text-[#5B0D1E] [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <ChevronDown size={16} className="shrink-0 text-[#a6536c] transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="max-w-[610px] pt-3 pr-8 text-[11px] leading-6 text-[#80616a]">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#40101c] text-[#faeee8]">
        <div className="container-wide grid gap-10 py-10 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <a className="focus-ring inline-flex items-center gap-3" href="#top">
              <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-[#f2becd]/40 bg-[#5B0D1E]"><img src={images.logo} alt="" className="h-full w-full scale-[1.35] object-cover" /></span>
              <span><span className="block font-display text-[24px] italic">Amore</span><span className="mt-1 block text-[8px] font-bold uppercase tracking-[.2em] text-[#e1a9b7]">Flavor Rewards</span></span>
            </a>
            <p className="mt-4 max-w-[330px] text-[10px] leading-6 text-[#dfc2c4]">A flavor-loving community, bringing bright ideas to the Amore Cookies kitchen.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-3 text-[9px] font-semibold text-[#f3d7d9]" aria-label="Footer navigation">
            {navItems.map((item) => <a key={item.href} className="focus-ring transition-colors hover:text-white" href={item.href}>{item.label}</a>)}
          </nav>
          <div className="flex flex-col gap-2 border-t border-[#fff3ed]/15 pt-5 text-[8px] leading-5 text-[#c8a9ae] md:col-span-2 md:flex-row md:items-center md:justify-between">
            <span>© {new Date().getFullYear()} Amore Cookies. Made for good ideas.</span>
            <span>Flavor Rewards is an introduction; program details will be shared before participation opens.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
