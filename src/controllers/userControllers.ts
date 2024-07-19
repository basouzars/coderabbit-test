import { Request, Response } from 'express';

let users = [{ id: 1, name: 'John Doe' }];

export const getUsers = (req: Request, res: Response) => {
  res.json(users);
};

export const createUser = (req: Request, res: Response) => {
  const newUser = req.body;
  users.push(newUser);
  res.status(201).json(newUser);
};

