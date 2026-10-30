import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function RulesDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          How it works
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>One board, your choice of seats</DialogTitle>
        <DialogDescription>
          2v2 is White 1, Black 1, White 2, Black 2. 1v1 is one player per side. 2v1 gives one color two alternating players and the other color every move.
        </DialogDescription>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-cream-dim">
          <p>
            The creator picks the mode when the table opens. The game starts when that mode's seats are filled. Only the player whose turn it is can move, and the server checks every move.
          </p>
          <p>
            Ordinary chess rules apply: castling, en passant, and promotion to a queen, rook, bishop, or knight.
            Checkmate wins. Stalemate, threefold repetition, the fifty-move rule, and insufficient material are draws,
            applied automatically.
          </p>
          <p>
            Offer a draw on your turn. Anyone on the other side can accept, or they can decline by answering or by moving. Resigning loses for your side. A clock, if you set one, is shared by the side and pauses if the player to move disconnects.
          </p>
          <p data-testid="rules-checkers">
            <span className="font-medium text-cream">Relay Checkers</span> uses American checkers on the same tables and seats. Men move one square
            diagonally forward; captures are mandatory and a jump must continue while another capture is available. A man that reaches the far row
            is crowned and its move ends; kings move and jump one square in any diagonal. You win when the other side has no pieces or no legal move.
            Threefold repetition and forty moves each without a capture or crowning are draws. White (light discs) moves first so the relay seat
            order matches chess; in tournament checkers dark moves first.
          </p>
          <p>
            <span className="font-medium text-cream">Missed win (checkers):</span> if you had a move that won on the spot (left the other side with
            no pieces or no legal move) and played something else, every piece of yours that could have made a winning move is removed, from its
            new square if it just moved. If that leaves you with no pieces, you lose.
          </p>
          <p>Refresh the page and you keep your seat. Send the invite link to fill the open seats.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
