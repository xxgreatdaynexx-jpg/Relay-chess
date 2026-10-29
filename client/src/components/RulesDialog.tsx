import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function RulesDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          How relay works
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Four players, one board</DialogTitle>
        <DialogDescription>
          White 1 moves first, then Black 1, then White 2, then Black 2, and back to White 1.
        </DialogDescription>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-cream-dim">
          <p>
            You and a partner share a side. Only the player whose turn it is can move, and the server checks every
            move.
          </p>
          <p>
            Ordinary chess rules apply: castling, en passant, and promotion to a queen, rook, bishop, or knight.
            Checkmate wins. Stalemate, threefold repetition, the fifty-move rule, and insufficient material are draws,
            applied automatically.
          </p>
          <p>
            Offer a draw on your turn. Either player on the other team can accept, or they can decline by answering or
            by moving. Resigning loses for your team. A clock, if you set one, is shared by the team and pauses if the
            player to move disconnects.
          </p>
          <p>Refresh the page and you keep your seat. Send the invite link to fill the other three.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
