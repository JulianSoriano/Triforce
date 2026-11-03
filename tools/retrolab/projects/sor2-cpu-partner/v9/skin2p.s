; v9: the versus-mode 2P skin in CPU PARTNER mode.  Duel mode (at $0108C6) gives player 2 the tile word $21D0 (palette
; line 1, the alternate colours) instead of $01D0 when both players picked the same character.  The co-op / CPU
; start-up (at $007E24) never did, so two Blazes looked identical.  Same test, same value.
;   a2 = player 2's object ($FFF000), 12(a2) = its character, -244(a2) = player 1's character.
; Replaces  bsr.w $007E9C / lea $FFF100.w,a0  (6100 0076 41f8 f100) at $007E24; the lea is done here.
	org	$1FAE00
	jsr	$7E9C			; what the original call did
	move.w	12(a2),d0
	cmp.w	-244(a2),d0
	bne.s	.done
	move.w	#$21D0,10(a2)
.done:
	lea	$FFFFF100.w,a0
	rts
