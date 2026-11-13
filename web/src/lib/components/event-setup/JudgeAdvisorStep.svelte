<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { JudgeEmailSchema } from '@robotools.app/protocol/src/email';

	/**
	 * Who is running this event.
	 *
	 * The first Judge Advisor used to be created anonymously — the row's name column simply
	 * defaulted to the string "Judge Advisor" — so a room with two advisors listed two
	 * identical entries until somebody renamed one.
	 *
	 * The address is the more important half. A judge who loses their link asks the Judge
	 * Advisor for another; a Judge Advisor who loses theirs has nothing inside the room that
	 * can reissue it, and has to go to whoever operates the server. Asking here, before
	 * anything else has been filled in, is the last point at which that is cheap.
	 *
	 * It stays optional, and the nudge is deliberately stronger than it once was. Setup used
	 * to make an advisor paste their own link back before continuing, which at least proved
	 * they had it somewhere; that step is gone, so an advisor who skips the address now has
	 * exactly one copy of their link — the one on screen, once.
	 */
	interface Props {
		name: string;
		email: string;
		onNext: () => void;
		onCancel: () => void;
	}

	let { name = $bindable(), email = $bindable(), onNext, onCancel }: Props = $props();

	let emailTouched = $state(false);

	const trimmedName = $derived(name.trim());
	const trimmedEmail = $derived(email.trim());
	const emailValid = $derived(trimmedEmail === '' || JudgeEmailSchema.safeParse(trimmedEmail).success);
	const canContinue = $derived(trimmedName.length > 0 && emailValid);

	function handleNext() {
		emailTouched = true;
		if (!canContinue) return;
		name = trimmedName;
		email = trimmedEmail;
		onNext();
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-xl font-semibold text-gray-900">{m.judge_advisor_step_title()}</h2>
		<p class="mt-1 text-sm text-gray-600">{m.judge_advisor_step_description()}</p>
	</div>

	<div class="space-y-4">
		<div>
			<label for="ja-name" class="mb-1 block text-sm font-medium text-gray-700">{m.judge_advisor_name_colon()}</label>
			<input
				id="ja-name"
				type="text"
				bind:value={name}
				maxlength="100"
				placeholder={m.judge_advisor_name_placeholder()}
				class="classic w-full"
			/>
		</div>

		<div>
			<label for="ja-email" class="mb-1 block text-sm font-medium text-gray-700">{m.judge_email()}</label>
			<input
				id="ja-email"
				type="email"
				bind:value={email}
				onblur={() => (emailTouched = true)}
				placeholder={m.judge_email_placeholder()}
				class="classic w-full"
				class:border-red-400={emailTouched && !emailValid}
			/>
			<!--
				The empty state gets its own note, in amber, from the moment the step opens.

				It is guidance rather than an error, so it does not wait for the field to be
				touched and it never blocks Continue — leaving the address out stays a choice.
				But it is a choice worth understanding, and it costs more than it used to: the
				setup flow used to make a Judge Advisor paste their link back to prove they had
				saved it, and with that gone the email is the only second copy anything makes.
			-->
			{#if emailTouched && !emailValid}
				<p class="mt-1 text-xs text-red-600">{m.judge_email_invalid()}</p>
			{:else if trimmedEmail === ''}
				<p class="mt-1 text-xs text-amber-700">{m.judge_advisor_email_missing()}</p>
			{:else}
				<p class="mt-1 text-xs text-gray-500">{m.judge_advisor_email_hint()}</p>
			{/if}
		</div>
	</div>

	<div class="flex justify-between">
		<button type="button" class="cancel" onclick={onCancel}>{m.cancel()}</button>
		<button type="button" class="primary" onclick={handleNext} disabled={!canContinue}>{m.continue_btn()}</button>
	</div>
</div>
