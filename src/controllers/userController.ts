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

export const updateUser = (req: Request, res: Response) => {
  const { id } = req.params;
  const updatedData = req.body;
  let user = users.find(user => user.id === parseInt(id));

  if (user) {
    user = { ...user, ...updatedData };
    users = users.filter(u => u !== undefined).map(u => (u.id === parseInt(id) ? user : u));
    res.json(user);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};
